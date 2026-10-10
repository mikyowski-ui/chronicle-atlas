###############################################################
## Sample Combining Datasets Code
## Converts the data format to long for 3 datasets and next
## combines the 3 datasets into one

## Script includes many extra steps and instances of looking at the data 
## structure to see what the script is doing for those users unfamiliar with R
###############################################################

# remove old variables
rm(list= ls())


# set working directory
# change to relevant working directory
# setwd('H:/Fall2013Thesis/azevedoSetoWork/combiningDatasetsCodeR/finalDatasets')

#################################################################
# Modelski Modern Data
#################################################################

# import the csv data
modern <- read.csv("modelskiModern.csv", stringsAsFactors=FALSE)

# look at the structure of the new object; 1 level of structure
str(modern, 1)

# create a object that contains the years (taken from the column names)
year <- colnames(modern)

# excluding the first 6 columns
year <- year[-c(1:6)]

# search and replace, in the year variable to create positive and negative years
# here only AD values
year <- gsub("BC_", "-", year)
year <- gsub("AD_", "", year) 

# convert to numeric object
year <- as.numeric(year)

# look at the first 5 rows of data
head(modern)

# change the data from wide to long format
# this dataset already in long format, just given as an example in case another dataset was not
long <- reshape(modern, direction="long", varying=list(colnames(modern)[-c(1:6)]), times=year)

# look at the data
str(long)

# fix the column name to read "pop" (it was AD_2000 previously)
colnames(long)[colnames(long) %in% "AD_2000"] <- "pop"

# look at data 
head(long)
str(long)

# select only those rows that do not have NA values (in the column of interest)
# here, no values should be NA, but there are NA cases in the next two datasets
long <- long[!is.na(long$pop), ]

# look at the structure of the data
str(long)

# check the frequency of each year in the data
as.matrix(table(long$time))

# sort the data.frame by year and by city
thisorder <- order(long$time, long$City)
long <- long[thisorder, ]

# look at the first 5 rows of the data now in sorted long format
head(long)


####################################################
# Modelski Ancient Data
####################################################

# import the csv data
ancient <- read.csv("modelskiAncient.csv", stringsAsFactors=FALSE, fileEncoding="latin1")

# look at the structure of the new object
str(ancient, 1)

# create a object that contains the years (taken from the column names)
year <- colnames(ancient)

# excluding the first 6 columns
year <- year[-c(1:6)]

# search and replace, in the year variable to create positive and negative years
year <- gsub("BC_", "-", year)
year <- gsub("AD_", "", year)

# convert to numeric object
year <- as.numeric(year)

# look at the first 5 rows of data
head(year)

# change the column names to be the years (except the first 6 columns)
colnames(ancient)[-c(1:6)] <- year

# check the first 5 rows of data
head(ancient)

# change the data from wide to long format
long2 <- reshape(ancient, direction="long", varying=list(colnames(ancient)[-c(1:6)]), times=year)

# look at the structure of the data
str(long2)

# fix the column name to read "pop" (it was -3700 previously)
colnames(long2)[colnames(long2) %in% "-3700"] <- "pop"

# select only those rows that do not have NA values (in the column of interest)
long2 <- long2[!is.na(long2$pop), ]

# look at the structure of the data 
str(long2)

# check the frequency of each year in the data
as.matrix(table(long2$time))

# sort the data frame by year and by city
thisorder <- order(long2$time, long2$City)
long2 <- long2[thisorder, ]

# look at the first 5 columns of data
head(long2)
 

###############################################################
# Chandler Data
###############################################################

# import the csv data
chandler <- read.csv("chandler.csv", stringsAsFactors=FALSE, fileEncoding="latin1")

# look at the structure of the new object (long list - truncated)
str(chandler)

# look at the first few column names of 2 different datasets
colnames(ancient)[1:10]
colnames(chandler)[1:10]

# create a object that contains the years (taken from the column names)
year <- colnames(chandler)[-c(1:6)]
year <- gsub("BC_", "-", year)
year <- gsub("AD_", "", year)

# convert to numeric object
year <- as.numeric(year)

# change the column names to be the years (except the first 6 columns)
colnames(chandler)[-c(1:6)] <- year


# if this long file already exists just load it, no need to recreate it
if("ylong.RData" %in% list.files()) {

  load("ylong.RData")

# if not, run this
} else {

# change the data from wide to long format
chandlerLong_list <- lapply(1:nrow(chandler), function(i) {
  # finding values that are not NA for all rows, but not the first 6 columns
  notna <- !is.na(chandler[i, -c(1:6)])
  # the population values that are not NA for all rows, but not the first 6 columns
  pop    <- chandler[i, -c(1:6)][notna]
  # define the cityid as the first 6 columns of all the rows
  cityid <- chandler[i, 1:6]
  
  # Nulling the rownames for population and cityid 
  rownames(pop) <- rownames(cityid) <- NULL
  # bind together the cityid (first 6 columns) with the year variable, pop
  these <- cbind(cityid, year=as.numeric(colnames(chandler)[-c(1:6)][notna]), pop,
    stringsAsFactors=FALSE)
})


# bring together the list objects for this one dataset - rows
ylong <- do.call("rbind", chandlerLong_list)

# look at the structure of the data
head(ylong)
str(ylong)

# save
save(ylong, file="ylong.RData")
}


######################################################################
# Organize the data
######################################################################

# make the columns match
# see the structure of each dataset
str(long)
str(ylong)
str(long2)

# change the column names in the long and long 2 datasets to match 
colnames(long)[colnames(long) %in% "time"] <- "year"
str(long)
colnames(long2)[colnames(long2) %in% "time"] <- "year"
str(long2)


# delete these column names from these datasets
long <- long[, !(colnames(long) %in% c("id"))]
long2 <- long2[, !(colnames(long2) %in% c("id"))]

# see the structure of each dataset
# check that all columns in all datasets match# make the columns match
str(long)
str(ylong)
str(long2)

# make this the order of your columns (currently in order)
cols <- c("City","OtherName", "Country","Latitude","Longitude","Certainty","year","pop")

# see the structure of each dataset (if order changed to check)
str(long)
str(ylong)
str(long2)

# stack the three long data.frames
alldata <- rbind(long[, cols], ylong[, cols], long2[,cols])
str(alldata)

# sort data by year and city
thisorder <- order(alldata$year, alldata$City)
alldata <- alldata[thisorder, ]
head(alldata)

# null the row names (these are the numbers out in front)
rownames(alldata) <- NULL

# check row names are removed
head(alldata)

# made a unique id for each city which include city name, lat and long
# round lat and long to 1 place after the decimal 
alldata$cityid <- paste(alldata$City, round(alldata$Latitude, 1),
  round(alldata$Longitude, 1), sep="_")
  
# check the frequency of each year in the data
as.matrix(table(alldata$year))

# add AD/BC year columns (instead of positive and negative numbers)
adbc <- alldata$year
adbc[alldata$year > 0] <- paste0("AD_", alldata$year[alldata$year > 0])
adbc[alldata$year < 0] <- paste0("BC_", abs(alldata$year[alldata$year < 0]))

# year as a factor
year.f <- factor(alldata$year, levels=sort(unique(alldata$year)),
  labels=unique(adbc)[order(unique(alldata$year))])

# take a look at the data
head(alldata[order(alldata$City, alldata$year), ])
summary(alldata)
sum(is.na(alldata$City))/nrow(alldata)
sum(is.na(alldata$Country))/nrow(alldata)
sum(is.na(alldata$Latitude))/nrow(alldata)

# check for duplicates using cityid, year and population value
# can later remove these duplicates (should be 22 total)
# these should all be between years 2000 BC and AD 1000 where the 
# Chandler and Modelski datasets overlap and the population values were the SAME
# one of each of the these can later be removed
check <- which(duplicated(paste0(alldata$cityid, alldata$year, alldata$pop)))
head(check)
str(check)

dupvals <- paste0(alldata$cityid, alldata$year)[check]
alldups <- which(paste0(alldata$cityid, alldata$year) %in% dupvals)
dupdata <- alldata[alldups, ]
dupdata[order(dupdata$cityid, dupdata$year), ]

# check for duplicates using cityid and year
# these should all be between years 2000 BC and AD 1000 where the 
# Chandler and Modelski datasets overlap (where pop values were the same and differing)
# Can remove one of each duplicate - 
# see #18 in "Limitations" section of paper
check <- which(duplicated(paste0(alldata$cityid, alldata$year)))
head(check)
str(check)

dupvals <- paste0(alldata$cityid, alldata$year)[check]
alldups <- which(paste0(alldata$cityid, alldata$year) %in% dupvals)
dupdata <- alldata[alldups, ]
dupdata[order(dupdata$cityid, dupdata$year), ]


# check for record matching a particular city for whichever cities you choose
alldata[alldata$City %in% "Birmingham", ]
alldata[alldata$City %in% "Springfield", ]

# sort by year increasing order
alldata <- alldata[order(alldata$year), ]
write.csv(alldata,'alldata.csv')


# save everything
save(list=c( "long", "ylong", "long2", "alldata", "chandler", "ancient", "modern"),
  file="AllObjects.RData")



